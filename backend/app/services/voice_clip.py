"""The CLIP DOOR (Phase 26 / D82, ASR_PLAN §3.6 + §3.7; S9) — decode → the pre-ASR pass → per-chunk ASR.

`POST /api/voice/stt` (push-to-talk and the whole-clip dictation fallback) no longer forwards the upload:
parakeet-server is WAV-only and has no no-speech guard (§3.6), so every clip is DECODED here (PyAV, any
MediaRecorder container → 16 kHz mono, bounded), run through the pass (`voice_prepass.prepass`, the
configured `vad_model`), and only the pass's chunks reach ASR — each as a 16 kHz pcm16 WAV, in order,
through `VoiceClient.transcribe(door="stt")`, the chain walking PER CHUNK. No speech ⇒ `""` and no ASR
call at all. Raw bytes are never forwarded and never logged.

Two pieces, because they have different callers:

* **`chunk_wavs` + `transcribe_wavs`** — THE chunk → WAV → transcribe → join helper. The clip door here,
  `tools/vad_replay.py --asr` (S6-ii's replay, which had its own copy of this loop until S9) and S7b's
  live worker all transcribe a pass's chunks the same way; this is the one place that does it.
* **`transcribe_clip`** — the door's orchestration, so the route stays "validate + delegate". Every
  CPU-bound or file step (the decode, the model's cold ORT session, the pass, the WAV wrap, the trail and
  the capture) runs on `asyncio.to_thread` — never on the event loop (the SYS-16 invariant, pinned by
  `test_arch_invariants_sys16.py`).

**The trail + capture (T9/T10, session-64 rulings H6/H7).** Under `voice.live.debug` with a trail store,
every clip-door request writes a trail of its own: a SERVER-minted id in the store's `clip` mode — or,
when the upload names the `call_id` of a streaming dictation (its whole-clip fallback), THAT dictation's
trail. Lines: `prepass` (T10: verdict, crop, pad, voiced ms, chunk bounds, decode/pass timings),
`capture_open {file}` and `asr` (T9: served-by, per-chunk latency, ok) — counts and timings only, NEVER
transcript text. The decoded 16 kHz PCM is captured through the SAME `CallTrail.open_capture` the relay
uses (0600, `trail_keep`, the prune guard, header-first `.part` → finalize), so
`tools/asr_corpus.py promote <id>-<leg>` takes a push-to-talk clip unchanged (SECURITY_MODEL §2.12: the
clip door is the third capture source).
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.adapters.voice import Door, VoiceError
from app.core.audio import pcm16_wav_header
from app.services.voice_audio import MODEL_RATE, float32_to_pcm16
from app.services.voice_prepass import PrepassResult, decode_to_pcm16k, prepass
from app.services.voice_vad import get_model

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

    from app.adapters.voice import VoiceClient
    from app.services.call_trail import CallTrail, LiveMode
    from app.services.voice_vad import VadModelName

log = logging.getLogger(__name__)

#: The decoded-duration bound's headroom over `voice.live.dictation_max_s` (§3.6, council 15): the clip door
#: aborts past `dictation_max_s + 60` s of decoded audio — the longest recording the client can make, plus a
#: minute for the recorder's own tail. The wall-time bound is `voice_prepass.DECODE_MAX_WALL_S` (60 s, the
#: same council ruling), the decode's own default.
CLIP_DECODE_HEADROOM_S = 60

#: The multipart file name every chunk is posted under — a WAV, because parakeet-server reads WAV only
#: (S9 audit §A) and a Whisper server routes by extension.
CHUNK_FILENAME = "chunk.wav"

#: The leg a CLIP trail's lines and capture carry — `promote <id>-1` (rulings H6/H7). One upload = one leg.
CLIP_LEG = 1
#: …and the leg the whole-clip FALLBACK writes into a DICTATION's trail. Not 1: the streaming leg is always
#: leg 1 (`useDictation`'s `trail: {callId, leg: 1}`), and its capture already holds `<id>-1.wav` — the
#: store's O_EXCL would refuse a second file there. 0 is never a streaming dictation leg.
DICTATION_CLIP_LEG = 0

#: T9/T10's `id` for the clip door: the whole upload is the one unit (the live door's are `seg_<n>`, S7b).
CLIP_SEGMENT_ID = "clip"


@dataclass(frozen=True, slots=True)
class ChunkServe:
    """Who served one chunk and what it cost (T9's per-chunk row)."""

    provider: str
    degraded: bool
    queue_ms: int
    asr_ms: int


@dataclass(frozen=True, slots=True)
class Transcript:
    """A pass's chunks, transcribed in order and joined with single spaces."""

    text: str
    serves: tuple[ChunkServe, ...]

    @property
    def served_by(self) -> str:
        """`X-Voice-Served-By` across chunks (ruling H5): the DISTINCT providers in serve order, ", "-joined
        — one name in the common case."""
        return ", ".join(dict.fromkeys(s.provider for s in self.serves))

    @property
    def degraded(self) -> bool:
        """Any chunk walked past a failed hop (ruling H5)."""
        return any(s.degraded for s in self.serves)


class ChunkFailed(VoiceError):
    """Every hop failed for chunk `index` — a `VoiceError` (the route's 502), carrying what the chunks
    before it cost so T9 can still record the attempt."""

    def __init__(self, message: str, *, index: int, serves: tuple[ChunkServe, ...]) -> None:
        super().__init__(message)
        self.index = index
        self.serves = serves


def chunk_wavs(result: PrepassResult) -> list[bytes]:
    """The pass's chunks as 16 kHz pcm16 mono WAV bodies, in order (empty on `no_speech`). CPU work (a
    30 s chunk is ~1 MB of numpy): call it off the loop, beside the pass."""
    out: list[bytes] = []
    for chunk in result.chunks:
        pcm = float32_to_pcm16(chunk)
        out.append(pcm16_wav_header(len(pcm) // 2, MODEL_RATE) + pcm)
    return out


async def transcribe_wavs(voice: VoiceClient, wavs: list[bytes], *, door: Door = "stt") -> Transcript:
    """THE chunk → transcribe → join loop: each WAV through `voice.transcribe(door=…)` in order (the chain
    walks PER CHUNK, §3.6), the stripped texts joined with single spaces. A chunk whose every hop fails
    raises `ChunkFailed` — never a transcript with a silent hole in it.

    THE PIN (S9 wave 1, the review's M1; D63's `prefer`): every chunk after the first asks FIRST for the
    hop that served the one before it. Without it a busy primary — parked on ANOTHER process's work, which
    this process's gate cannot see (§3.7 T-3) — or a hung one costs every chunk its own `timeout_s` before
    the walk; with it the clip pays that once and stays where it was served. One clip's scope, never sticky
    across requests; a pinned hop that fails walks the rest of the chain in its configured order. (Accepted
    trade-off: a clip pinned to a whisper fallback keeps that fallback's `language` behaviour for its rest.)"""
    texts: list[str] = []
    serves: list[ChunkServe] = []
    pin: str | None = None
    for i, wav in enumerate(wavs):
        try:
            text, reply = await voice.transcribe(
                content=wav, filename=CHUNK_FILENAME, content_type="audio/wav", door=door, prefer=pin
            )
        except VoiceError as exc:
            raise ChunkFailed(str(exc), index=i, serves=tuple(serves)) from exc
        pin = reply.target or None
        serves.append(ChunkServe(reply.served, reply.degraded, reply.queue_ms, reply.asr_ms))
        if text.strip():
            texts.append(text.strip())
    return Transcript(" ".join(texts), tuple(serves))


# ── the door ──────────────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ClipTrail:
    """Where one clip-door request writes its debug trail + capture (rulings H6/H7)."""

    store: CallTrail
    call_id: str
    mode: LiveMode
    leg: int
    keep: int


def clip_trail(store: CallTrail, *, keep: int, dictation_call_id: str | None) -> ClipTrail:
    """The trail for one upload: the named DICTATION's — its whole-clip fallback, and ONLY when that
    dictation's trail already exists (S9 wave 1, Emma Q8: a client-named id never mints a trail, so an
    unknown or a call's id cannot plant `calls/dictation/<id>.jsonl`) — else a fresh SERVER-minted id in the
    `clip` mode. Sync (the existence check is a stat): the route reaches it through `to_thread`. Only ever
    built under `voice.live.debug` with a store mounted; the id is the route's validated query."""
    if dictation_call_id is not None and store.has_trail(dictation_call_id, "dictation"):
        return ClipTrail(store, dictation_call_id, "dictation", DICTATION_CLIP_LEG, keep)
    return ClipTrail(store, str(uuid.uuid4()), "clip", CLIP_LEG, keep)


@dataclass(frozen=True, slots=True)
class ClipResult:
    """What the door answers: the joined text (`""` on no speech) and, when ASR ran, who served it."""

    text: str
    transcript: Transcript | None = None


def _ms(samples: int) -> int:
    return samples * 1000 // MODEL_RATE


def _pass(pcm: NDArray[np.float32], vad_model: VadModelName) -> tuple[PrepassResult, list[bytes], int]:
    """The pass + the chunk WAVs in ONE worker hop: `get_model` builds the ORT session on a cold cache
    (file + CPU work), the pass loops every hop of the clip, and the WAV wrap is numpy — none of it may
    touch the loop."""
    started = time.perf_counter()
    result = prepass(pcm, get_model(vad_model))
    wavs = chunk_wavs(result)
    return result, wavs, round((time.perf_counter() - started) * 1000)


def _line(trail: ClipTrail, ev: str, **fields: Any) -> dict[str, Any]:
    # `src: "clip"` — neither the relay's nor the browser's half: the clip door's own lines.
    return {"t": int(time.time() * 1000), "src": "clip", "leg": trail.leg, "ev": ev, **fields}


def _record(trail: ClipTrail, pcm: NDArray[np.float32], prepass_line: dict[str, Any]) -> None:
    """T10 + the capture, sync (one `to_thread`): the trail line FIRST — creating the trail is what prunes
    its directory, so the capture can never be an orphan no prune reaches (S6-ii ruling H3) — then the
    decoded 16 kHz PCM through the relay's own writer, finalized at once (the whole clip is in hand)."""
    store = trail.store
    store.append(trail.call_id, [prepass_line], keep=trail.keep, mode=trail.mode)
    writer = store.open_capture(trail.call_id, trail.leg, rate=MODEL_RATE, mode=trail.mode)
    if writer is not None:
        try:
            writer.append(float32_to_pcm16(pcm))
        finally:
            writer.finalize()
    name = None if writer is None or writer.failed else writer.name
    store.append(trail.call_id, [_line(trail, "capture_open", file=name)], keep=trail.keep, mode=trail.mode)


async def transcribe_clip(
    voice: VoiceClient,
    data: bytes,
    *,
    vad_model: VadModelName,
    max_decoded_s: float,
    from_ms: int = 0,
    trail: ClipTrail | None = None,
) -> ClipResult:
    """Decode → pass → per-chunk ASR (module docstring). Raises what the decode raises
    (`UndecodableAudio`, `DecodeAborted` — the route maps them) and `VoiceError` (502). `from_ms` trims the
    decoded head (the S8 recovery's suffix; the route exposes `?from_ms=`, the client sends it from S8) and counts toward the bound."""
    started = time.perf_counter()
    pcm = await asyncio.to_thread(decode_to_pcm16k, data, max_decoded_s=max_decoded_s, from_ms=from_ms)
    decode_ms = round((time.perf_counter() - started) * 1000)
    result, wavs, prepass_ms = await asyncio.to_thread(_pass, pcm, vad_model)
    if trail is not None:
        line = _line(
            trail,
            "prepass",
            id=CLIP_SEGMENT_ID,
            verdict=result.outcome,
            crop_ms=[_ms(result.crop[0]), _ms(result.crop[1])] if result.outcome == "ok" else None,
            padded=result.padded,
            voiced_ms=sum(_ms(e - s) for s, e in result.spans),
            chunks=[[_ms(s), _ms(e)] for s, e in result.bounds],
            decoded_ms=_ms(len(pcm)),
            from_ms=from_ms,
            decode_ms=decode_ms,
            prepass_ms=prepass_ms,
        )
        await asyncio.to_thread(_record, trail, pcm, line)
    # Released BEFORE the ASR loop (S9 wave 1, the review's L1): a 30-min clip's float32 (~115 MB) and the
    # pass's padded copy would otherwise live through minutes of sequential requests — the WAV bodies are
    # all the loop needs.
    no_speech = result.outcome == "no_speech"
    del pcm, result
    if no_speech:
        return ClipResult("")
    try:
        transcript = await transcribe_wavs(voice, wavs, door="stt")
    except ChunkFailed as exc:
        if trail is not None:
            partial = Transcript("", exc.serves)
            await _record_asr(trail, partial, chunks=len(wavs), prepass_ms=prepass_ms, failed_chunk=exc.index)
        raise
    if trail is not None:
        await _record_asr(trail, transcript, chunks=len(wavs), prepass_ms=prepass_ms)
    return ClipResult(transcript.text, transcript)


async def _record_asr(
    trail: ClipTrail, transcript: Transcript, *, chunks: int, prepass_ms: int, failed_chunk: int | None = None
) -> None:
    """T9 — counts and timings only (the transcript's TEXT never reaches a trail). `ok: false` +
    `failed_chunk` when a chunk's every hop failed; `serves` then covers the chunks before it."""
    serves = transcript.serves
    fields: dict[str, Any] = {
        "id": CLIP_SEGMENT_ID,
        "door": "stt",
        "provider": transcript.served_by or None,
        "degraded": transcript.degraded,
        "queue_ms": sum(s.queue_ms for s in serves),
        "prepass_ms": prepass_ms,
        "asr_ms": sum(s.asr_ms for s in serves),
        "chunks": chunks,
        "ok": failed_chunk is None,
        "per_chunk": [{"provider": s.provider, "queue_ms": s.queue_ms, "asr_ms": s.asr_ms} for s in serves],
    }
    if failed_chunk is not None:
        fields["failed_chunk"] = failed_chunk
    line = _line(trail, "asr", **fields)
    await asyncio.to_thread(trail.store.append, trail.call_id, [line], keep=trail.keep, mode=trail.mode)
