"""`app/core/audio.trim_wav_silence` + its one call site, `VoiceClient.synthesize` (D76 S3a).

PocketTTS pads every clip with 320–760 ms of −81 dBFS digital silence before the first sound; the
live call's leak probe listens to the head of each chunk, so the pad is cut at the one TTS chokepoint.
What the arms pin:

* the cut itself — `lead`/`tail` kept exactly, in sample FRAMES (stereo never shears), for pcm16 and
  float32, plain and WAVE_FORMAT_EXTENSIBLE;
* the RIFF walk (the council amendment): every skip is `size + size % 2`, every pre-`data` chunk
  survives byte-for-byte (an odd-sized one with its pad byte), an `fmt ` extension is carried, and
  ONLY the `data` + RIFF sizes are rewritten; a chunk after `data` is dropped;
* the pass-through contract — anything not fully understood comes back as the SAME object;
* the threshold semantics (−70 dBFS is pad, −50 is signal), the onset RUN (PocketTTS's lone
  first-frame click is not speech; two loud frames are), and a loose timing bound;
* the knob at the chokepoint: ON trims a padded WAV, OFF is byte-identical, non-WAV untouched either
  way — sniffed from the bytes, never from the asked format.

Plain asserts; no fixtures, no I/O. The float cases re-parse with the local reader (the stdlib `wave`
module reads pcm only), the pcm16 ones with `wave` too.
"""

from __future__ import annotations

import asyncio
import io
import math
import struct
import time
import wave

from _reg import target
from test_voice_6a import _fake_client

from app.adapters.voice import VoiceClient
from app.core.audio import TRIM_LEAD_MS, TRIM_TAIL_MS, trim_wav_silence
from app.domain.provider import SttPolicy, TtsPolicy

RATE = 24000
_GUID_TAIL = b"\x00\x00\x00\x00\x10\x00\x80\x00\x00\xaa\x00\x38\x9b\x71"


# --- a tiny WAV writer / reader ------------------------------------------------------------------


def _chunk(cid: bytes, body: bytes) -> bytes:
    """One RIFF chunk, word-aligned: an odd body gets its (uncounted) pad byte."""
    return cid + struct.pack("<I", len(body)) + body + (b"\x00" if len(body) % 2 else b"")


def _fmt_body(tag: int, channels: int, bits: int, *, rate: int = RATE, extensible: bool = False) -> bytes:
    align = channels * bits // 8
    if not extensible:
        return struct.pack("<HHIIHH", tag, channels, rate, rate * align, align, bits)
    return (
        struct.pack("<HHIIHH", 0xFFFE, channels, rate, rate * align, align, bits)
        + struct.pack("<HHI", 22, bits, 0x3 if channels == 2 else 0x4)
        + struct.pack("<H", tag)
        + _GUID_TAIL
    )


def _wav(fmt: bytes, pcm: bytes, *, before: bytes = b"", after: bytes = b"") -> bytes:
    """`before` = raw chunks between `fmt ` and `data`; `after` = raw chunks past `data`."""
    body = b"WAVE" + _chunk(b"fmt ", fmt) + before + _chunk(b"data", pcm) + after
    return b"RIFF" + struct.pack("<I", len(body)) + body


def _chunks(wav: bytes) -> list[tuple[bytes, bytes]]:
    """Every (id, body) in a WAV — the local reader that also re-parses float clips."""
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    (riff,) = struct.unpack_from("<I", wav, 4)
    assert riff == len(wav) - 8, "RIFF size must cover exactly the rest of the file"
    out, pos = [], 12
    while pos < len(wav):
        cid = wav[pos : pos + 4]
        (size,) = struct.unpack_from("<I", wav, pos + 4)
        out.append((cid, wav[pos + 8 : pos + 8 + size]))
        pos += 8 + size + size % 2
    assert pos == len(wav)
    return out


def _data(wav: bytes) -> bytes:
    return dict(_chunks(wav))[b"data"]


def _frames(ms: float, rate: int = RATE) -> int:
    return int(rate * ms / 1000)


def _tone(ms: float, dbfs: float, channels: int = 1) -> list[float]:
    """A 440 Hz sine whose RMS is `dbfs` (peak = rms·√2), interleaved over `channels`."""
    amp = 10 ** (dbfs / 20) * math.sqrt(2)
    out: list[float] = []
    for i in range(_frames(ms)):
        v = amp * math.sin(2 * math.pi * 440 * i / RATE)
        out.extend([v] * channels)
    return out


def _silence(ms: float, channels: int = 1) -> list[float]:
    return [0.0] * (_frames(ms) * channels)


def _f32(samples: list[float]) -> bytes:
    return struct.pack(f"<{len(samples)}f", *samples)


def _s16(samples: list[float]) -> bytes:
    return struct.pack(f"<{len(samples)}h", *(round(s * 32767) for s in samples))


def _padded(
    channels: int = 1, lead_pad: float = 700, voiced: float = 500, tail_pad: float = 900
) -> list[float]:
    return _silence(lead_pad, channels) + _tone(voiced, -20, channels) + _silence(tail_pad, channels)


# --- the cut ------------------------------------------------------------------------------------


def test_float32_mono_trims_to_voiced_plus_lead_and_tail() -> None:
    fmt = _fmt_body(3, 1, 32)
    src = _wav(fmt, _f32(_padded()))
    out = trim_wav_silence(src)
    chunks = _chunks(out)  # also asserts the RIFF size is exact
    assert [c for c, _ in chunks] == [b"fmt ", b"data"]
    assert chunks[0][1] == fmt  # fmt bytes identical
    frames = len(_data(out)) // 4
    frame = _frames(10)
    assert abs(frames - _frames(500 + TRIM_LEAD_MS + TRIM_TAIL_MS)) <= frame
    # the kept audio IS the source's, sliced — nothing re-encoded
    assert _data(out) in _data(src)


def test_pcm16_stereo_keeps_lead_and_tail_exactly() -> None:
    # Pad lengths on the 10 ms frame grid so the voiced span's first/last frame is exact.
    pcm = _s16(_padded(channels=2, lead_pad=700, voiced=500, tail_pad=900))
    src = _wav(_fmt_body(1, 2, 16), pcm)
    out = trim_wav_silence(src)
    with wave.open(io.BytesIO(out)) as w:  # the stdlib parses it back
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (2, 2, RATE)
        kept = w.getnframes()
        raw = w.readframes(kept)
    assert kept == _frames(TRIM_LEAD_MS) + _frames(500) + _frames(TRIM_TAIL_MS)
    # starts exactly `lead` before the tone's first sample frame (4 bytes per stereo frame)
    start = (_frames(700) - _frames(TRIM_LEAD_MS)) * 4
    assert raw == pcm[start : start + kept * 4]
    left, right = raw[0::4], raw[2::4]
    assert len(left) == len(right)  # frames, not samples — the channels never shear


def test_list_between_fmt_and_data_survives_trailing_chunk_dropped() -> None:
    fmt = _fmt_body(3, 1, 32)
    listing = _chunk(b"LIST", b"INFOISFT\x06\x00\x00\x00ctrlb\x00")
    fact = _chunk(b"fact", struct.pack("<I", 12345))
    src = _wav(fmt, _f32(_padded()), before=listing + fact, after=_chunk(b"LIST", b"INFOtrailing"))
    out = trim_wav_silence(src)
    assert out is not src
    head_end = src.index(b"data")
    assert out[12:head_end] == src[12:head_end]  # every pre-data chunk byte-for-byte
    assert [c for c, _ in _chunks(out)] == [b"fmt ", b"LIST", b"fact", b"data"]  # trailer gone
    assert out.endswith(_data(out))


def test_odd_sized_pre_data_chunk_is_skipped_by_its_pad_byte_and_kept_verbatim() -> None:
    """The council amendment: a chunk of odd size is followed by one pad byte its size does not count;
    a walker that skips `size` instead of `size + size % 2` lands one byte short and never finds `data`
    (the clip would silently pass through untrimmed)."""
    fmt = _fmt_body(3, 1, 32)
    odd = _chunk(b"junk", b"abc")  # size 3 + a pad byte
    assert len(odd) == 12
    src = _wav(fmt, _f32(_padded()), before=odd)
    out = trim_wav_silence(src)
    assert out is not src and len(out) < len(src)
    assert out[12 : 12 + 8 + 16 + 12] == src[12 : 12 + 8 + 16 + 12]  # fmt + the odd chunk + its pad
    assert [c for c, _ in _chunks(out)] == [b"fmt ", b"junk", b"data"]


def test_only_data_and_riff_sizes_are_rewritten() -> None:
    fmt = _fmt_body(1, 1, 16)
    src = _wav(fmt, _s16(_padded()), before=_chunk(b"LIST", b"INFOx"))
    out = trim_wav_silence(src)
    data_at = src.index(b"data")
    new_len = len(out) - data_at - 8
    assert out[:4] == b"RIFF" and struct.unpack_from("<I", out, 4)[0] == len(out) - 8
    assert out[8:data_at] == src[8:data_at]  # WAVE + fmt + LIST untouched
    assert out[data_at : data_at + 4] == b"data"
    assert struct.unpack_from("<I", out, data_at + 4)[0] == new_len
    assert new_len % 2 == 0  # an even block align ⇒ word-aligned data, no pad byte needed


def test_fmt_extension_bytes_are_carried() -> None:
    """A plain-tag `fmt ` with a cbSize extension (size 18) is accepted and carried verbatim."""
    fmt = _fmt_body(3, 1, 32) + struct.pack("<H", 0)
    src = _wav(fmt, _f32(_padded()))
    out = trim_wav_silence(src)
    assert out is not src
    assert _chunks(out)[0] == (b"fmt ", fmt)


def test_extensible_pcm_subformat_is_trimmed() -> None:
    fmt = _fmt_body(1, 2, 16, extensible=True)
    src = _wav(fmt, _s16(_padded(channels=2)))
    out = trim_wav_silence(src)
    assert out is not src
    assert _chunks(out)[0] == (b"fmt ", fmt)  # the 40-byte EXTENSIBLE body verbatim
    assert len(_data(out)) // 4 == _frames(TRIM_LEAD_MS) + _frames(500) + _frames(TRIM_TAIL_MS)


def test_extensible_float_subformat_is_trimmed() -> None:
    src = _wav(_fmt_body(3, 1, 32, extensible=True), _f32(_padded()))
    assert trim_wav_silence(src) is not src


def test_extensible_unknown_subformat_passes_through() -> None:
    fmt = bytearray(_fmt_body(1, 1, 16, extensible=True))
    fmt[-1] ^= 0xFF  # not the KSDATAFORMAT GUID tail
    src = _wav(bytes(fmt), _s16(_padded()))
    assert trim_wav_silence(src) is src


def test_lone_click_is_not_an_onset() -> None:
    """Every PocketTTS clip opens with a ~−58 dBFS decoder blip confined to its first 10 ms frame, then
    the −81 dBFS pad. One loud frame is a click, not speech (`TRIM_MIN_RUN_FRAMES`): the cut still lands
    `lead` before the real onset — and a lone click after the last word is dropped with the tail pad."""
    blip = _tone(10, -58)
    click = _tone(10, -45)
    samples = blip + _silence(690) + _tone(500, -20) + _silence(400) + click + _silence(490)
    src = _wav(_fmt_body(3, 1, 32), _f32(samples))
    out = trim_wav_silence(src)
    kept = len(_data(out)) // 4
    assert kept == _frames(TRIM_LEAD_MS) + _frames(500) + _frames(TRIM_TAIL_MS)
    start = (_frames(700) - _frames(TRIM_LEAD_MS)) * 4
    assert _data(out) == _data(src)[start : start + kept * 4]


def test_two_loud_frames_are_an_onset() -> None:
    """The run is exactly `TRIM_MIN_RUN_FRAMES` long: a 20 ms burst on the frame grid is sound."""
    samples = _silence(500) + _tone(20, -30) + _silence(500)
    out = trim_wav_silence(_wav(_fmt_body(3, 1, 32), _f32(samples)))
    assert len(_data(out)) // 4 == _frames(TRIM_LEAD_MS) + _frames(20) + _frames(TRIM_TAIL_MS)


# --- pass-through: the same object back -----------------------------------------------------------


def test_all_silent_clip_is_returned_unchanged() -> None:
    src = _wav(_fmt_body(3, 1, 32), _f32(_silence(1500)))
    assert trim_wav_silence(src) is src


def test_clip_voiced_end_to_end_is_returned_unchanged() -> None:
    src = _wav(_fmt_body(3, 1, 32), _f32(_tone(800, -20)))
    assert trim_wav_silence(src) is src


def test_not_riff_is_returned_unchanged() -> None:
    mp3ish = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 100
    assert trim_wav_silence(mp3ish) is mp3ish
    ogg = b"OggS" + bytes(200)
    assert trim_wav_silence(ogg) is ogg
    assert trim_wav_silence(b"") == b""


def test_truncated_or_streaming_written_is_returned_unchanged() -> None:
    src = _wav(_fmt_body(3, 1, 32), _f32(_padded()))
    for cut in (4, 11, 20, 40, len(src) - 100):  # header / fmt / data torn at every depth
        torn = src[:cut]
        assert trim_wav_silence(torn) is torn
    data_at = src.index(b"data")
    for size in (0, 0xFFFFFFFF):  # a writer that never seeked back
        streamed = src[: data_at + 4] + struct.pack("<I", size) + src[data_at + 8 :]
        assert trim_wav_silence(streamed) is streamed
    no_data = src[:data_at]
    assert trim_wav_silence(no_data) is no_data
    torn_frame = _wav(_fmt_body(3, 1, 32), _f32(_padded()) + b"\x01\x02")  # half a sample
    assert trim_wav_silence(torn_frame) is torn_frame


def test_unsupported_formats_are_returned_unchanged() -> None:
    samples = _padded()
    pcm24 = b"".join(struct.pack("<i", round(s * 8388607))[:3] for s in samples)
    for wav in (
        _wav(_fmt_body(1, 1, 24), pcm24),  # 24-bit pcm
        _wav(_fmt_body(3, 1, 64), struct.pack(f"<{len(samples)}d", *samples)),  # float64
        _wav(_fmt_body(1, 3, 16), _s16(_padded(channels=3))),  # 3 channels
        _wav(_fmt_body(6, 1, 8), bytes(len(samples))),  # a-law
    ):
        assert trim_wav_silence(wav) is wav


def test_threshold_semantics_minus70_is_pad_minus50_is_signal() -> None:
    quiet = _wav(_fmt_body(3, 1, 32), _f32(_silence(500) + _tone(500, -70) + _silence(500)))
    assert trim_wav_silence(quiet) is quiet  # all of it reads as pad → not ours to erase
    soft = _wav(_fmt_body(3, 1, 32), _f32(_silence(500) + _tone(500, -50) + _silence(500)))
    out = trim_wav_silence(soft)
    assert out is not soft
    assert len(_data(out)) // 4 == _frames(TRIM_LEAD_MS) + _frames(500) + _frames(TRIM_TAIL_MS)


def test_ten_second_stereo_float_trims_quickly() -> None:
    """Loose bound (the brief's target is far under it): a 10 s stereo float clip, 4 s of pad each
    side, and the all-silent worst case that scans every frame."""
    padded = _wav(_fmt_body(3, 2, 32), _f32(_padded(channels=2, lead_pad=4000, voiced=2000, tail_pad=4000)))
    silent = _wav(_fmt_body(3, 2, 32), _f32(_silence(10_000, channels=2)))
    for src in (padded, silent):
        t0 = time.perf_counter()
        trim_wav_silence(src)
        assert time.perf_counter() - t0 < 0.1


# --- the chokepoint: `VoiceClient.synthesize` ------------------------------------------------------


def _client(response: bytes, *, trim_silence: bool, fmt: str = "wav") -> VoiceClient:
    vc = VoiceClient(
        (),
        SttPolicy(),
        (target("pocket", "http://p/v1", "pocket", fmt=fmt),),
        TtsPolicy(),
        trim_silence=trim_silence,
    )
    by_url = {"http://p/v1": _fake_client(on_speech=lambda *a: response)}
    vc._client = lambda t, ct, tt: by_url[t.base_url]  # type: ignore[assignment]
    return vc


def test_synthesize_trims_a_padded_wav_when_on() -> None:
    padded = _wav(_fmt_body(3, 1, 32), _f32(_padded()))
    audio, media_type, _ = asyncio.run(_client(padded, trim_silence=True).synthesize(text="hi"))
    assert audio == trim_wav_silence(padded) and len(audio) < len(padded)
    assert media_type == "audio/wav"


def test_synthesize_wav_answered_to_an_opus_ask_is_still_trimmed() -> None:
    """PocketTTS answers WAV to ANY `response_format` — the bytes decide, not the asked format."""
    padded = _wav(_fmt_body(3, 1, 32), _f32(_padded()))
    vc = _client(padded, trim_silence=True, fmt="opus")
    audio, media_type, _ = asyncio.run(vc.synthesize(text="hi", audio_format="opus"))
    assert len(audio) < len(padded)
    # …and the media type follows the bytes too (the S3 code round, F1): WAV, not `audio/ogg`.
    assert media_type == "audio/wav"


def test_synthesize_is_byte_identical_when_off() -> None:
    padded = _wav(_fmt_body(3, 1, 32), _f32(_padded()))
    audio, _, _ = asyncio.run(_client(padded, trim_silence=False).synthesize(text="hi"))
    assert audio == padded


def test_synthesize_leaves_mp3_untouched_either_way() -> None:
    mp3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 100
    for on in (True, False):
        audio, _, _ = asyncio.run(_client(mp3, trim_silence=on, fmt="mp3").synthesize(text="hi"))
        assert audio == mp3


def test_trim_silence_defaults_on_and_threads_from_settings() -> None:
    """Additive field, default ON (no migration); `runtime.set_voice` freezes it into the client."""
    from types import SimpleNamespace

    from app.config import Settings
    from app.core.provider_registry import EndpointGates
    from app.runtime import set_voice

    assert Settings().voice.tts.trim_silence is True
    for on in (True, False):
        settings = Settings.model_validate({"voice": {"tts": {"trim_silence": on}}})
        app = SimpleNamespace(state=SimpleNamespace(settings=settings, endpoint_gates=EndpointGates()))
        registry = SimpleNamespace(
            stt_chain=(),
            stt_policy=SttPolicy(),
            tts_chain=(),
            tts_policy=TtsPolicy(),
            live_chain=(),
            live_policy=None,
        )
        set_voice(app, registry)  # type: ignore[arg-type]
        assert app.state.voice._trim_silence is on
