"""Phase 26 S6-ii — the debug capture, the receipt stamps, the replay tool and the corpus tool
(ASR_PLAN §6.1–§6.3, §3.2; session-64 rulings H1–H14; SECURITY_MODEL §2.12).

The arms, by what they defend:

* **the gate** — a capture exists only under EXACTLY the trail's predicate (`voice.live.debug` on, the
  store mounted, a client-named call), from the session-start snapshot (a mid-call flip changes nothing);
  off the gate the 16 kHz copy's resampler is never even built (H2).
* **the file** — `<call>-<leg>.wav` beside its trail (dictation one directory down), the received stream
  after the anti-aliased resampler: the 16 kHz wire bit-exact (no PyAV import), a 48 kHz leg as the
  resampler's output plus its `flush()` tail; dirs 0700 / file 0600; finalized on every end path; header
  first with all-ones sizes as a `.part` (H1) — readable by stdlib `wave` and the shipped decode, finalized
  or not; created `O_EXCL` (H12); the trail lands before the first audio byte (H3); a pruned trail takes
  its captures; a write failure degrades the capture, never the leg.
* **the stamps** — each accepted frame's `(leg_index, client_samples)` minted at receipt (H4); an
  evicted frame is a GAP: `gap_ms` on the leg end + one debug `gap` line per burst.
* **the header helper** — the ONE WAV writer (`core/audio.pcm16_wav_header`).
* **the replay** — the MEASURED edges on the fixture, the H6 baseline, `--set` columns, `--variant m1`,
  `--model`, the pre-pass sweep (and the H7 `act=` override it rides), `--asr` through the existing
  `VoiceClient.transcribe`, and its exit codes.
* **the corpus** — promote / label / list / prune, and every refusal (no home · a git tree · a clobber ·
  no `--owner-only` · no language).
"""

from __future__ import annotations

import asyncio
import importlib.util
import inspect
import io
import json
import logging
import os
import struct
import sys
import threading
import time
import wave
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from test_voice_live_s1 import (
    CALL,
    ORIGIN,
    SUPERSEDED,
    TAB,
    FakeSpeaches,
    _admitted,
    _closed,
    _drain_until,
    _fake_app,
    _fakes_app,
    _json,
    _leg_ends,
    _pcm,
    _traced,
    _wait_for,
    created,
)

from app.config import Settings
from app.core.audio import WAV_HEADER_BYTES, WAV_UNKNOWN_SIZE, pcm16_wav_header
from app.runtime import apply_settings_inplace
from app.services import call_trail as call_trail_mod
from app.services import voice_live
from app.services.call_trail import CallTrail, CaptureWriter
from app.services.voice_audio import PcmResampler, float32_to_pcm16
from app.services.voice_live import LiveRelaySession
from app.services.voice_prepass import PrepassResult, decode_to_pcm16k, prepass, scan
from app.services.voice_vad import VAD_MODELS, get_model

TOOLS = Path(__file__).resolve().parents[2] / "tools"
FIXTURE = Path(__file__).resolve().parent / "data" / "silero_test_3s.wav"
WAV = f"{CALL}-3.wav"


def _tool(name: str) -> ModuleType:
    """Load a `tools/` script by path (the first tests that drive a tool: `main([...])` + `capsys`)."""
    spec = importlib.util.spec_from_file_location(f"_tool_{name}", TOOLS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses resolve their module through `sys.modules`
    spec.loader.exec_module(module)
    return module


def _debug_app(tmp_path: Path, fake: FakeSpeaches | None = None, **live: Any) -> Any:
    trail = CallTrail(tmp_path / "calls")
    return _fake_app(fake or FakeSpeaches([created()]), live_cfg={"debug": True, **live}, trail=trail)


def _stop(ws: Any) -> None:
    ws.send_json({"type": "stop"})
    assert _drain_until(ws, "state")["state"] == "ended"
    assert _closed(ws)[0] == 1000


def _audio_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if ".wav" in p.name)


def _lines(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def _ramp(samples: int, start: int) -> bytes:
    """A distinct pcm16 ramp, so a bit-exact comparison means something."""
    return struct.pack(f"<{samples}h", *(((start + i) % 20000) - 10000 for i in range(samples)))


def _never_built(*_a: Any, **_kw: Any) -> Any:
    raise AssertionError("the 16 kHz copy's resampler was built outside the capture gate (H2)")


@pytest.fixture
def journal(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="app.services.voice_live")
    caplog.set_level(logging.INFO, logger="app.services.call_trail")  # (one level: it is the handler's too)
    return caplog


# ── the gate (§6.1: the trail's own) ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("arm", ["debug_off", "no_call_id", "no_store"])
def test_a_capture_exists_only_under_the_trails_exact_gate(
    arm: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(voice_live, "PcmResampler", _never_built)
    trail = None if arm == "no_store" else CallTrail(tmp_path / "calls")
    app = _fake_app(FakeSpeaches([created()]), live_cfg={"debug": arm != "debug_off"}, trail=trail)
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        if arm == "no_call_id":
            ws.send_json({"type": "start", "sample_rate": 48000})
            assert _json(ws) == {"type": "state", "state": "ready"}
        else:
            _traced(ws)
        for _ in range(3):
            ws.send_bytes(_pcm(1920))
        _stop(ws)
    assert _audio_files(tmp_path) == []


@pytest.mark.parametrize("start_debug", [False, True])
def test_a_mid_call_debug_flip_changes_nothing(start_debug: bool, tmp_path: Path) -> None:
    """The gate reads the SESSION-START snapshot (`cfg`): a Conf save mid-leg is applied to the LIVE
    settings object exactly as the Conf route does it (`apply_settings_inplace`) — the next leg sees it,
    this one neither starts nor stops recording, and (ON → OFF) still writes its trail to the end."""
    app = (
        _debug_app(tmp_path)
        if start_debug
        else _fake_app(
            FakeSpeaches([created()]), live_cfg={"debug": False}, trail=CallTrail(tmp_path / "calls")
        )
    )
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=16000)
        live = app.app.state.settings
        apply_settings_inplace(
            app.app,
            Settings.model_validate({"voice": {"live": {"enabled": True, "debug": not start_debug}}}),
        )
        assert live is app.app.state.settings and live.voice.live.debug is (not start_debug)
        for _ in range(3):
            ws.send_bytes(_pcm(640))
        _stop(ws)
    assert [p.name for p in _audio_files(tmp_path)] == ([WAV] if start_debug else [])
    trail = tmp_path / "calls" / f"{CALL}.jsonl"
    if start_debug:  # the snapshot kept the trail AND the capture going to the leg's end
        end = _lines(trail)[-1]
        assert (end["ev"], end["capture"], end["capture_ms"]) == ("leg_end", WAV, 120)
    else:
        assert not trail.exists()


# ── the file ──────────────────────────────────────────────────────────────────────────────────────


def test_a_16k_leg_records_the_wire_bit_exact_without_pyav(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """K6's main path: the resampler is an IDENTITY that never imports PyAV (blocked here), so the file is
    the client's own wire, sample for sample; finalized: no `.part` left, the header patched."""
    monkeypatch.setitem(sys.modules, "av", None)  # `import av` now raises
    frames = [_ramp(640, i * 640) for i in range(5)]
    with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=16000)
        for frame in frames:
            ws.send_bytes(frame)
        _stop(ws)
    monkeypatch.delitem(sys.modules, "av")
    assert _audio_files(tmp_path) == [tmp_path / "calls" / WAV]
    with wave.open(str(tmp_path / "calls" / WAV), "rb") as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 16000, 3200)
        assert w.readframes(3200) == b"".join(frames)
    lines = _lines(tmp_path / "calls" / f"{CALL}.jsonl")
    assert lines[0]["ev"] == "leg_start" and "capture" not in lines[0]
    assert (lines[1]["ev"], lines[1]["file"]) == ("capture_open", WAV)
    assert (lines[-1]["ev"], lines[-1]["capture"], lines[-1]["capture_ms"]) == ("leg_end", WAV, 200)


def test_a_48k_leg_records_the_resampled_copy_and_its_flushed_tail(tmp_path: Path) -> None:
    """The native-rate fallback: the file is `PcmResampler`'s output — every frame plus the delay line
    only `flush()` returns — so it is exactly a third of what was sent, and identical to a direct run."""
    frames = [_ramp(1920, i * 1920) for i in range(5)]
    with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=48000)
        for frame in frames:
            ws.send_bytes(frame)
        _stop(ws)
    direct = PcmResampler(48000)
    expected = b"".join(direct.feed(f) for f in frames) + direct.flush()
    with wave.open(str(tmp_path / "calls" / WAV), "rb") as w:
        assert (w.getframerate(), w.getnframes()) == (16000, 5 * 1920 // 3)
        assert w.readframes(w.getnframes()) == expected


def test_a_dictation_capture_lives_beside_its_trail_and_both_are_owner_only(tmp_path: Path) -> None:
    with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        ws.send_json({"type": "start", "sample_rate": 16000, "mode": "dictation", "call_id": CALL, "leg": 3})
        assert _json(ws) == {"type": "state", "state": "ready"}
        ws.send_bytes(_pcm(640))
        _stop(ws)
    dictation = tmp_path / "calls" / "dictation"
    assert _audio_files(tmp_path) == [dictation / WAV]
    assert (dictation / f"{CALL}.jsonl").is_file()
    if os.name != "nt":
        for d in (tmp_path / "calls", dictation):
            assert d.stat().st_mode & 0o777 == 0o700
        assert (dictation / WAV).stat().st_mode & 0o777 == 0o600


def test_the_trail_lands_before_the_capture_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """H3 + wave 1 (Opus LOW-1): the relay flushes the trail's first batch at `leg_start` and only THEN
    opens the capture — the `.jsonl` exists at the moment the `.part` is created, so a crash between the
    two orphans nothing. By `ready` the capture is a 44-byte header-first `.part`, sizes all-ones (H1)."""
    trail = tmp_path / "calls" / f"{CALL}.jsonl"
    original = CallTrail.open_capture
    seen: list[bool] = []

    def spy(self: CallTrail, *a: Any, **kw: Any) -> CaptureWriter | None:
        seen.append(trail.is_file() and _lines(trail)[0]["ev"] == "leg_start")
        return original(self, *a, **kw)

    monkeypatch.setattr(CallTrail, "open_capture", spy)
    with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=16000)
        assert seen == [True]
        assert _lines(trail)[0] | {"t": 0} == {
            "t": 0,
            "src": "relay",
            "leg": 3,
            "ev": "leg_start",
            "rate": 16000,
            "mode": "call",
            "session": _lines(trail)[0]["session"],
        }
        part = (tmp_path / "calls" / f"{WAV}.part").read_bytes()
        assert part == pcm16_wav_header(None, 16000) and len(part) == WAV_HEADER_BYTES
        assert (
            struct.unpack_from("<I", part, 4)[0] == struct.unpack_from("<I", part, 40)[0] == WAV_UNKNOWN_SIZE
        )
        _stop(ws)


@pytest.mark.parametrize("end", ["stop", "protocol", "client_gone"])
def test_the_capture_is_finalized_on_every_end_path(end: str, tmp_path: Path) -> None:
    with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=16000)
        for _ in range(3):
            ws.send_bytes(_pcm(640))
        if end == "stop":
            _stop(ws)
        elif end == "protocol":
            ws.send_json({"type": "hello"})
            assert _drain_until(ws, "error")["code"] == "protocol"
            assert _closed(ws)[0] == 1008
        else:
            ws.close(code=1006)
            _wait_for(lambda: (tmp_path / "calls" / WAV).exists())
    _wait_for(lambda: (tmp_path / "calls" / WAV).exists())
    assert _audio_files(tmp_path) == [tmp_path / "calls" / WAV]
    with wave.open(str(tmp_path / "calls" / WAV), "rb") as w:
        assert w.getnframes() == 3 * 640


def test_a_superseded_leg_finalizes_its_capture(tmp_path: Path) -> None:
    trail = CallTrail(tmp_path / "calls")
    client = _fakes_app(
        FakeSpeaches([created()]), FakeSpeaches([created()]), live_cfg={"debug": True}, trail=trail
    )
    with client, client.websocket_connect("/api/voice/live", headers=ORIGIN) as a:
        _admitted(a, TAB, call_id=CALL, leg=0)
        a.send_bytes(_pcm(1920))
        with client.websocket_connect("/api/voice/live", headers=ORIGIN) as b:
            _admitted(b, TAB, call_id=CALL, leg=1)
            assert _json(a) == SUPERSEDED
            _wait_for(lambda: (tmp_path / "calls" / f"{CALL}-0.wav").exists())
            _stop(b)
    assert sorted(p.name for p in _audio_files(tmp_path)) == [f"{CALL}-0.wav", f"{CALL}-1.wav"]


def test_a_reused_leg_records_nothing_and_never_overwrites(tmp_path: Path, journal: Any) -> None:
    """H12: the second leg with the same (call id, leg) finds the first's file — `O_EXCL` on the `.part`,
    and the finalized twin refused too — so it records no audio and says so; the first file is intact."""
    app = _debug_app(tmp_path, FakeSpeaches([created()]))
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=16000)
        ws.send_bytes(_ramp(640, 7))
        _stop(ws)
    first = (tmp_path / "calls" / WAV).read_bytes()
    app = _debug_app(tmp_path, FakeSpeaches([created()]))
    with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=16000)
        ws.send_bytes(_pcm(640))
        _stop(ws)
    assert (tmp_path / "calls" / WAV).read_bytes() == first
    assert _audio_files(tmp_path) == [tmp_path / "calls" / WAV]
    opens = [line for line in _lines(tmp_path / "calls" / f"{CALL}.jsonl") if line["ev"] == "capture_open"]
    assert [o["file"] for o in opens] == [WAV, None]
    ends = [line for line in _lines(tmp_path / "calls" / f"{CALL}.jsonl") if line["ev"] == "leg_end"]
    assert [(e["capture"], e["capture_ms"]) for e in ends] == [(WAV, 40), (None, None)]
    hits = [r for r in journal.records if "already has a capture" in r.getMessage()]
    assert len(hits) == 1 and CALL not in hits[0].getMessage()


class _FailingAfter:
    """A file stand-in whose `write` raises `OSError` after `ok` successful writes (a disk filling up)."""

    def __init__(self, real: Any, ok: int) -> None:
        self._real, self._ok = real, ok

    def write(self, data: bytes) -> int:
        if self._ok <= 0:
            raise OSError(28, "No space left on device")
        self._ok -= 1
        return self._real.write(data)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._real, name)


def test_a_write_failure_degrades_the_capture_never_the_leg(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, journal: Any
) -> None:
    """The first 1 s batch lands, the tail's write fails: the leg ends cleanly, ONE warning is logged, and
    the capture stays a `.part` whose all-ones header the shipped decode still reads (§6.1)."""
    original = CallTrail.open_capture

    def failing(self: CallTrail, *a: Any, **kw: Any) -> CaptureWriter | None:
        writer = original(self, *a, **kw)
        assert writer is not None
        writer._f = _FailingAfter(writer._f, ok=1)  # noqa: SLF001 — the one seam into the file
        return writer

    monkeypatch.setattr(CallTrail, "open_capture", failing)
    frames = [_ramp(640, i) for i in range(30)]  # 25 frames = one 1 s batch, then a 5-frame tail
    with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=16000)
        for frame in frames:
            ws.send_bytes(frame)
        _stop(ws)
    part = tmp_path / "calls" / f"{WAV}.part"
    assert _audio_files(tmp_path) == [part]
    pcm = float32_to_pcm16(decode_to_pcm16k(part.read_bytes(), max_decoded_s=60))
    assert pcm == b"".join(frames[:25])
    warned = [r for r in journal.records if "call capture: cannot write" in r.getMessage()]
    assert len(warned) == 1
    end = _lines(tmp_path / "calls" / f"{CALL}.jsonl")[-1]
    # what the file HOLDS, not what was handed over (Opus LOW-2): the first batch, 1000 ms
    assert (end["ev"], end["capture"], end["capture_ms"]) == ("leg_end", "degraded", 1000)


class _BlockedWriter:
    """A capture writer whose `append` blocks on a gate (a hung disk) — the real writer underneath."""

    def __init__(self, real: CaptureWriter, gate: threading.Event) -> None:
        self._real, self._gate = real, gate
        self.calls = 0

    def append(self, pcm: bytes) -> None:
        self.calls += 1
        self._gate.wait(10)
        self._real.append(pcm)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._real, name)


def test_a_hung_disk_bounds_the_capture_buffer_and_degrades_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, journal: Any
) -> None:
    """Wave 1 (Emma HIGH = Opus MED-1): with the first batch's write hung, ONE flush is pending (never a
    task per frame), the buffer never exceeds two batches, and past that the capture DEGRADES — one
    warning, nothing more buffered or resampled — while the leg keeps running and ends cleanly; the
    trail says `degraded` and counts only what was written."""
    gate = threading.Event()
    sessions: list[LiveRelaySession] = []
    peaks = {"buf": 0, "tasks": 0}
    original_open = CallTrail.open_capture
    original_buffer = LiveRelaySession._buffer_capture

    def blocked(self: CallTrail, *a: Any, **kw: Any) -> Any:
        writer = original_open(self, *a, **kw)
        assert writer is not None
        return _BlockedWriter(writer, gate)

    def spy(self: LiveRelaySession, pcm16k: bytes) -> None:
        if not sessions:
            sessions.append(self)
        original_buffer(self, pcm16k)
        peaks["buf"] = max(peaks["buf"], self._capture_buf_bytes)
        peaks["tasks"] = max(peaks["tasks"], len(self._capture_tasks))

    monkeypatch.setattr(CallTrail, "open_capture", blocked)
    monkeypatch.setattr(LiveRelaySession, "_buffer_capture", spy)
    frames = 100  # 4 s of 16 kHz audio against a disk that accepts nothing
    with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=16000)
        for i in range(frames):
            ws.send_bytes(_ramp(640, i))
        _wait_for(lambda: bool(sessions) and sessions[0]._capture_degraded)
        session = sessions[0]
        assert session._capture_resampler is None and session._capture_buf_bytes == 0
        ws.send_bytes(_pcm(640))  # the leg is alive: still accepted after the degrade
        gate.set()  # the disk comes back; the in-flight batch lands
        _stop(ws)
    assert peaks["tasks"] <= 1
    assert peaks["buf"] <= 2 * voice_live.CAPTURE_BATCH_BYTES
    assert [r.getMessage() for r in journal.records if "too slow" in r.getMessage()] != []
    end = _lines(tmp_path / "calls" / f"{CALL}.jsonl")[-1]
    assert (end["ev"], end["capture"], end["capture_ms"], end["frames"]) == ("leg_end", "degraded", 1000, 101)
    with wave.open(str(tmp_path / "calls" / WAV), "rb") as w:  # finalized: what reached the disk
        assert w.getnframes() == 16000


def test_the_resampler_is_drained_only_in_the_teardown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Wave 1 (Emma MED): `PcmResampler.flush()` runs once, from `_finish_capture` inside `run()`'s
    shielded `finally` — never from `_close`'s leg-end latch — and the trail's `leg_end` is still the
    LAST line, carrying the tail (5 × 40 ms at 48 kHz = exactly 200 ms with the delay line)."""
    calls: list[list[str]] = []
    original = PcmResampler.flush

    def spy(self: PcmResampler) -> bytes:
        calls.append([f.function for f in inspect.stack()[1:6]])
        return original(self)

    monkeypatch.setattr(PcmResampler, "flush", spy)
    with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=48000)
        for i in range(5):
            ws.send_bytes(_ramp(1920, i))
        _stop(ws)
    assert len(calls) == 1
    assert "_finish_capture" in calls[0] and "_close" not in calls[0] and "_note_leg_end" not in calls[0]
    lines = _lines(tmp_path / "calls" / f"{CALL}.jsonl")
    assert [line["ev"] for line in lines].count("leg_end") == 1
    assert (lines[-1]["ev"], lines[-1]["code"], lines[-1]["capture_ms"]) == ("leg_end", 1000, 200)


def test_a_48k_capture_is_time_aligned_with_the_leg_clock(tmp_path: Path) -> None:
    """S8's ±350 ms gate rests on it: WAV sample k ↔ leg sample 3k at 48 kHz. An impulse at a known leg
    sample (4800 = 100 ms in, inside the 3rd 40 ms frame) peaks at WAV sample 1600."""
    at = 4800
    signal = [0] * (1920 * 5)
    signal[at] = 30000
    pcm = struct.pack(f"<{len(signal)}h", *signal)
    with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        _traced(ws, rate=48000)
        for i in range(5):
            ws.send_bytes(pcm[i * 3840 : (i + 1) * 3840])
        _stop(ws)
    with wave.open(str(tmp_path / "calls" / WAV), "rb") as w:
        out = struct.unpack(f"<{w.getnframes()}h", w.readframes(w.getnframes()))
    assert len(out) == len(signal) // 3
    assert max(range(len(out)), key=lambda k: abs(out[k])) == at // 3


@pytest.mark.skipif(os.name == "nt" or os.geteuid() == 0, reason="POSIX permission semantics")
def test_an_unwritable_root_costs_one_warning_and_no_leg(tmp_path: Path, journal: Any) -> None:
    root = tmp_path / "calls"
    root.mkdir(mode=0o500)
    try:
        with _debug_app(tmp_path).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
            _traced(ws, rate=16000)
            ws.send_bytes(_pcm(640))
            _stop(ws)
    finally:
        root.chmod(0o700)
    assert _audio_files(tmp_path) == []
    # the trail and the capture share the store's warn-once: one failing disk, one line
    assert len([r for r in journal.records if "further failures are silent" in r.getMessage()]) == 1


# ── the receipt stamps + the gap (§3.2, ruling H4) ────────────────────────────────────────────────


def test_every_accepted_frame_is_stamped_at_receipt_on_the_leg_clock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[Any] = []
    original = LiveRelaySession._enqueue

    async def spy(self: LiveRelaySession, pcm: bytes, *, drop_oldest: bool, receipt: Any = None) -> None:
        seen.append(None if receipt is None else tuple(receipt))
        await original(self, pcm, drop_oldest=drop_oldest, receipt=receipt)

    monkeypatch.setattr(LiveRelaySession, "_enqueue", spy)
    with _fake_app(FakeSpeaches([created()])).websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
        ws.send_json({"type": "start", "sample_rate": 48000})
        assert _json(ws) == {"type": "state", "state": "ready"}
        for n in (1920, 960, 1920):
            ws.send_bytes(_pcm(n))
        ws.send_json({"type": "flush"})  # the relay's own silence: never stamped
        _stop(ws)
    assert seen[:3] == [(0, 1920), (1920, 960), (2880, 1920)]
    assert len(seen) > 3 and set(seen[3:]) == {None}


def test_an_evicted_frame_is_a_gap_on_the_leg_end_and_one_trail_line_per_burst(
    tmp_path: Path, journal: Any
) -> None:
    """20 frames into a depth-5 queue nothing drains: 15 evicted = 600 ms of GAP on the always-on leg end,
    and ONE debug `gap` line for the burst (where it began, how much it lost). The capture still holds
    all 800 ms — it is written at receipt — which is how a replay sees what the live ear did not."""

    async def gated(_self: Any) -> None:
        await asyncio.Event().wait()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(LiveRelaySession, "_pump_uplink", gated)
        app = _debug_app(tmp_path, relay_queue_ms=200, frame_ms=40)
        with app.websocket_connect("/api/voice/live", headers=ORIGIN) as ws:
            _traced(ws, rate=24000)
            for _ in range(20):
                ws.send_bytes(_pcm(960))
            assert _drain_until(ws, "state")["state"] == "degraded"
            _stop(ws)
    _wait_for(lambda: _leg_ends(journal))  # the teardown runs on the portal thread
    (end,) = _leg_ends(journal)
    assert (end["drops"], end["gap_ms"]) == ("15", "600")
    lines = _lines(tmp_path / "calls" / f"{CALL}.jsonl")
    gaps = [line for line in lines if line["ev"] == "gap"]
    assert [(g["at_ms"], g["ms"]) for g in gaps] == [(0, 600)]
    assert lines[-1]["ev"] == "leg_end" and lines[-1]["gap_ms"] == 600 and lines[-1]["capture_ms"] == 800


# ── the ONE WAV header (core/audio) ───────────────────────────────────────────────────────────────


def test_the_wav_header_finalized_and_placeholder() -> None:
    pcm = _ramp(1000, 3)
    for n in (500, None):
        blob = pcm16_wav_header(n, 16000) + pcm
        with wave.open(io.BytesIO(blob), "rb") as w:
            assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 16000)
            assert w.readframes(10**9) == (pcm if n is None else pcm[:1000])
        decoded = float32_to_pcm16(decode_to_pcm16k(blob, max_decoded_s=60))
        assert decoded == (pcm if n is None else pcm[:1000])
    head = pcm16_wav_header(500, 16000)
    assert len(head) == WAV_HEADER_BYTES == 44
    assert struct.unpack_from("<4sI4s4sIHHIIHH4sI", head) == (
        b"RIFF",
        36 + 1000,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        16000,
        32000,
        2,
        16,
        b"data",
        1000,
    )
    assert struct.unpack_from("<I", pcm16_wav_header(10, 8000, channels=2), 40)[0] == 40
    for bad in ((-1, 16000), (1, 0), (2**31, 16000)):
        with pytest.raises(ValueError):
            pcm16_wav_header(*bad)


# ── the store: open / finalize / O_EXCL / prune ───────────────────────────────────────────────────


def _call(n: int) -> str:
    return f"{n:08x}-1b3d-4e5f-8a9b-0c1d2e3f4a5b"


def test_open_capture_refuses_a_bad_identity(tmp_path: Path) -> None:
    trail = CallTrail(tmp_path / "calls")
    for kw in ({"call_id": "../x", "leg": 0}, {"call_id": CALL, "leg": -1}, {"call_id": CALL, "leg": True}):
        with pytest.raises(ValueError):
            trail.open_capture(kw["call_id"], kw["leg"], rate=16000)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        trail.open_capture(CALL, 0, rate=16000, mode="chat")  # type: ignore[arg-type]
    assert not (tmp_path / "calls").exists()


def test_a_crashed_part_is_importable_and_a_torn_byte_is_dropped(tmp_path: Path) -> None:
    trail = CallTrail(tmp_path / "calls")
    writer = trail.open_capture(CALL, 0, rate=16000)
    assert writer is not None
    pcm = _ramp(4000, 1)
    writer.append(pcm)
    writer._f.write(b"\x07")  # noqa: SLF001 — a torn half-sample, as a crash mid-write leaves
    writer._f.flush()  # noqa: SLF001
    part = tmp_path / "calls" / f"{CALL}-0.wav{call_trail_mod.CAPTURE_PART_SUFFIX}"  # never finalized
    blob = part.read_bytes()
    assert blob[:WAV_HEADER_BYTES] == pcm16_wav_header(None, 16000)
    assert float32_to_pcm16(decode_to_pcm16k(blob, max_decoded_s=60)) == pcm


def test_a_pruned_trail_takes_its_captures_and_nothing_else(tmp_path: Path) -> None:
    root = tmp_path / "calls"
    trail = CallTrail(root)
    old, other_mode = _call(1), _call(2)
    trail.append(old, [{"ev": "a"}], keep=1)
    w = trail.open_capture(old, 0, rate=16000)
    assert w is not None
    w.append(_pcm(16))
    w.finalize()  # leg 0 finalized…
    (root / f"{old}-1.wav.part").write_bytes(pcm16_wav_header(None, 16000))  # …leg 1 crashed as a `.part`
    trail.append(other_mode, [{"ev": "a"}], keep=1, mode="dictation")
    w = trail.open_capture(other_mode, 0, rate=16000, mode="dictation")
    assert w is not None
    w.finalize()
    time.sleep(0.01)
    trail.append(CALL, [{"ev": "a"}], keep=1)  # a NEW call: keep=1 prunes the old one, captures and all
    w = trail.open_capture(CALL, 0, rate=16000)
    assert w is not None
    w.finalize()
    assert sorted(p.name for p in root.iterdir() if p.is_file()) == [f"{CALL}-0.wav", f"{CALL}.jsonl"]
    assert sorted(p.name for p in (root / "dictation").iterdir()) == [
        f"{other_mode}-0.wav",
        f"{other_mode}.jsonl",
    ]


def test_the_prune_never_takes_a_call_with_an_open_capture(tmp_path: Path) -> None:
    """The prune guard (ruled before wave 1): a long leg whose trail fell out of `trail_keep` while it
    is still recording (two live sessions) keeps its trail and its `.part` until the writer closes —
    keyed on the OPEN writer, not on a `.part` existing (a crashed `.part` stays prunable)."""
    root = tmp_path / "calls"
    trail = CallTrail(root)
    live, crashed = _call(1), _call(2)
    for call in (live, crashed):
        trail.append(call, [{"ev": "a"}], keep=20)
        time.sleep(0.01)
    writer = trail.open_capture(live, 0, rate=16000)
    assert writer is not None
    (root / f"{crashed}-0.wav.part").write_bytes(pcm16_wav_header(None, 16000))  # a crash's leftover
    time.sleep(0.01)
    trail.append(CALL, [{"ev": "a"}], keep=1)  # a new call: keep=1 would prune both older calls
    names = sorted(p.name for p in root.iterdir())
    assert f"{live}.jsonl" in names and f"{live}-0.wav.part" in names  # guarded while open
    assert f"{crashed}.jsonl" not in names and f"{crashed}-0.wav.part" not in names  # a crash is not
    writer.finalize()
    time.sleep(0.01)
    trail.append(_call(3), [{"ev": "a"}], keep=1)  # closed now: the next prune takes it, audio and all
    assert not [p for p in root.iterdir() if p.name.startswith(live)]


def test_finalize_patches_the_sizes_and_is_idempotent(tmp_path: Path) -> None:
    trail = CallTrail(tmp_path / "calls")
    writer = trail.open_capture(CALL, 9, rate=16000, mode="dictation")
    assert writer is not None and writer.name == f"{CALL}-9.wav"
    writer.append(_pcm(320))
    writer.append(_pcm(320))
    writer.finalize()
    writer.finalize()
    writer.append(_pcm(320))  # after finalize: a no-op, never a write to a closed file
    path = tmp_path / "calls" / "dictation" / f"{CALL}-9.wav"
    with wave.open(str(path), "rb") as w:
        assert w.getnframes() == 640
    assert writer.samples == 640 and not writer.failed


# ── the pre-pass `act=` override (ruling H7) ──────────────────────────────────────────────────────


def test_the_prepass_act_override_defaults_to_the_models_own() -> None:
    model = get_model("silero-v6.2")
    pcm = decode_to_pcm16k(FIXTURE.read_bytes(), max_decoded_s=60)
    default = scan(pcm, model)[1]
    assert default == scan(pcm, model, act=model.prepass_act)[1] == [(512, 32256), (43008, 48000)]
    # a stricter act starts later and ends sooner (MEASURED: 96–1984 and 2720–3000 ms at 0.9)
    assert scan(pcm, model, act=0.9)[1] == [(1536, 31744), (43520, 48000)]
    assert prepass(pcm, model, act=0.9).outcome == "ok"


# ── the replay tool (§6.2, §3.4.1 ⑦) ──────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def replay_tool() -> ModuleType:
    return _tool("vad_replay")


def _segment_rows(out: str, column: str) -> list[tuple[int, int | None, int, str]]:
    """The `(start, confirm, end, reason)` rows printed under `-- [column]`."""
    rows: list[tuple[int, int | None, int, str]] = []
    in_col = False
    for line in out.splitlines():
        if line.startswith("-- ["):
            in_col = line.startswith(f"-- [{column}]")
            continue
        parts = line.split()
        if in_col and len(parts) >= 5 and parts[0].isdigit():
            if len(parts) == 6:
                rows.append((int(parts[1]), int(parts[2]), int(parts[3]), parts[4]))
            else:
                rows.append((int(parts[1]), None, int(parts[2]), parts[3]))
        elif in_col and not line.startswith("  "):
            in_col = False
    return rows


def test_replay_prints_the_measured_edges_for_the_fixture(replay_tool: ModuleType, capsys: Any) -> None:
    """MEASURED on v6.2 (and identical on v5.1.2): the H6 baseline (act 0.6 · onset 200 · silence 700 ·
    the config's 300 ms pre-roll · 20 s) holds the 3 s clip as ONE segment; at silence 500 the 672 ms gap
    ends it at 2560 and a second opens — its START back by the pre-roll (2420 at 300, 2220 at 500)."""
    rc = replay_tool.main(
        [str(FIXTURE), "--set", "silence_ms=500", "--set", "silence_ms=500", "prefix_padding_ms=500"]
    )
    out = capsys.readouterr().out
    assert rc == 0
    cls = VAD_MODELS["silero-v6.2"]
    assert out.splitlines()[0].startswith(f"model silero-v6.2 · sha256 {cls.sha256} ")
    assert "default_act 0.6" in out.splitlines()[0]
    assert _segment_rows(out, "A") == [(0, 256, 3000, "flush")]
    assert _segment_rows(out, "B") == [(0, 256, 2560, "endpoint"), (2420, 2944, 3000, "flush")]
    assert _segment_rows(out, "C") == [(0, 256, 2560, "endpoint"), (2220, 2944, 3000, "flush")]
    assert "act=0.6 onset_ms=200 silence_ms=700 prefix_padding_ms=300 max_segment_s=20" in out
    assert " 1.000" in out  # max_p rides every stop


def test_replay_model_variant_and_the_dictation_baseline(
    replay_tool: ModuleType, capsys: Any, tmp_path: Path
) -> None:
    dictation = tmp_path / "calls" / "dictation"
    dictation.mkdir(parents=True)
    clip = dictation / f"{CALL}-0.wav"
    clip.write_bytes(FIXTURE.read_bytes())
    assert replay_tool.main([str(clip), "--model", "silero-v5.1.2", "--variant", "m1"]) == 0
    out = capsys.readouterr().out
    assert out.startswith(f"model silero-v5.1.2 · sha256 {VAD_MODELS['silero-v5.1.2'].sha256}")
    assert "onset_ms=0 " in out and "dictation)" in out  # §3.4's dictation row: every crossing counts
    assert "-- [A+m1]" in out and "variant=m1" in out
    # MEASURED: the crossing hop is [32, 64) ms — confirmed AT it (onset 0), its pre-roll clamped to 0
    assert _segment_rows(out, "A") == _segment_rows(out, "A+m1") == [(0, 64, 3000, "flush")]


@pytest.mark.parametrize(
    ("argv", "code"),
    [
        (["--set", "bogus=1"], 2),
        (["--set", "variant=m1"], 2),  # `--variant` owns that field
        (["--set", "act=x"], 2),
        (["--set", "max_segment_s=1"], 2),  # `derive` refuses the cap — before any audio is read
        (["--prepass-sweep", "0:2:1"], 2),
        (["--asr", "http://ear/v1"], 2),  # needs --asr-model
        (["--model", "nope"], 2),
    ],
)
def test_replay_usage_errors_exit_2(replay_tool: ModuleType, argv: list[str], code: int, capsys: Any) -> None:
    assert replay_tool.main([str(FIXTURE), *argv]) == code


def test_replay_an_unreadable_input_exits_1(replay_tool: ModuleType, tmp_path: Path, capsys: Any) -> None:
    junk = tmp_path / "junk.wav"
    junk.write_bytes(b"not audio at all")
    assert replay_tool.main([str(junk), str(tmp_path / "missing.wav")]) == 1
    assert "cannot read" in capsys.readouterr().err


def test_replay_prepass_sweep_counts_labelled_speech(
    replay_tool: ModuleType, tmp_path: Path, capsys: Any
) -> None:
    """The §6.4 S9-gate row: per act, each FILE's verdict and each replayed SEGMENT's, read against the
    corpus label's `kind` — labelled speech answered `no_speech` must be 0."""
    corpus = tmp_path / "asr-corpus"
    (corpus / "raw").mkdir(parents=True)
    (corpus / "labels").mkdir()
    clip = corpus / "raw" / "20261007-120000-call-call-en-0f8e2c4a-0.wav"
    clip.write_bytes(FIXTURE.read_bytes())
    (corpus / "labels" / f"{clip.stem}.json").write_text(json.dumps({"kind": "positive"}))
    assert replay_tool.main([str(clip), "--prepass-sweep", "0.5,0.9"]) == 0
    out = capsys.readouterr().out
    assert "act 0.5: labelled speech answered no_speech = 0 (must be 0)" in out
    assert "act 0.9: labelled speech answered no_speech = 0 (must be 0)" in out
    rows = [line.split() for line in out.splitlines() if line.strip().startswith(("0.5 ", "0.9 "))]
    assert [(r[0], r[2], r[3], r[4], r[5]) for r in rows] == [
        ("0.5", "positive", "ok", "1", "0"),
        ("0.9", "positive", "ok", "1", "0"),
    ]


def test_replay_asr_goes_through_the_existing_voice_client(
    replay_tool: ModuleType, monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    """`--asr`: each segment through the pass, one 16 kHz WAV per pass chunk into the REAL
    `VoiceClient.transcribe` (patched at the class — the request shape is its, not the tool's)."""
    from app.adapters.voice import VoiceClient

    sent: list[bytes] = []

    async def fake_transcribe(
        self: VoiceClient, *, content: bytes, filename: str, content_type: str | None
    ) -> Any:
        assert (filename, content_type) == ("seg.wav", "audio/wav")
        sent.append(content)
        return f"words{len(sent)}", None

    monkeypatch.setattr(VoiceClient, "transcribe", fake_transcribe)
    rc = replay_tool.main(
        [str(FIXTURE), "--asr", "http://ear:9000/v1", "--asr-model", "parakeet", "--lang", "en"]
    )
    out = capsys.readouterr().out
    assert rc == 0
    pcm = decode_to_pcm16k(FIXTURE.read_bytes(), max_decoded_s=60)
    expected = prepass(pcm, get_model("silero-v6.2")).chunks  # the one segment spans the whole clip
    assert len(sent) == len(expected) == 1
    with wave.open(io.BytesIO(sent[0]), "rb") as w:
        assert (w.getnchannels(), w.getframerate(), w.getnframes()) == (1, 16000, len(expected[0]))
    assert "flush       1.000  words1" in out


def test_replay_a_no_speech_segment_makes_no_asr_call(
    replay_tool: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.adapters.voice import VoiceClient

    async def boom(*_a: Any, **_kw: Any) -> Any:
        raise AssertionError("a no_speech segment must not reach ASR")

    monkeypatch.setattr(VoiceClient, "transcribe", boom)
    segment = replay_tool.Segment(start_ms=0)
    failed = asyncio.run(
        replay_tool.transcribe_all(
            "http://ear/v1", "m", "", [(segment, PrepassResult("no_speech", [], [], 512))]
        )
    )
    assert failed == 0 and segment.transcript == "<no_speech>"


# ── the corpus tool (§6.3) ────────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def corpus_tool() -> ModuleType:
    return _tool("asr_corpus")


def _seed_capture(root: Path, *, lang: str | None = "en", part: bool = False, leg: int = 0) -> bytes:
    """A dev instance's capture + its trail, as the relay and the browser write them."""
    trail = CallTrail(root / "calls")
    session: dict[str, Any] = {"turn_detection": {"type": "server_vad"}}
    if lang is not None:
        session["input_audio_transcription"] = {"language": lang}
    t = 1791302199591  # 2026-10-06T…Z
    trail.append(
        CALL,
        [
            {"t": t, "src": "relay", "leg": leg, "ev": "leg_start", "rate": 16000, "session": session},
            {"t": t + 5, "src": "client", "leg": leg, "ev": "capture", "route": "car", "label": "x"},
        ],
        keep=20,
    )
    writer = trail.open_capture(CALL, leg, rate=16000)
    assert writer is not None
    pcm = _ramp(16000, 5)
    writer.append(pcm)
    if not part:
        writer.finalize()
    return pcm


def test_corpus_promote_label_list_prune(corpus_tool: ModuleType, tmp_path: Path, capsys: Any) -> None:
    dev, home = tmp_path / "dev", tmp_path / "prod"
    pcm = _seed_capture(dev)
    argv = ["--home", str(home), "promote", f"{CALL}-0", "--owner-only", "--from", str(dev), "--label", "yes"]
    assert corpus_tool.main(argv) == 0
    out = capsys.readouterr().out
    assert "OWNER'S OWN VOICE ONLY" in out  # the consent rule is printed on every promotion (H11)
    corpus = home / "asr-corpus"
    when = time.strftime("%Y%m%d-%H%M%S", time.gmtime(1791302199.591))
    clip = f"{when}-call-car-en-{CALL[:8]}-0.wav"  # H5: …-<call8>-<leg>
    raw = corpus / "raw" / clip
    with wave.open(str(raw), "rb") as w:
        assert (w.getframerate(), w.getnframes()) == (16000, 16000)
        assert w.readframes(16000) == pcm
    label = json.loads((corpus / "labels" / f"{raw.stem}.json").read_text())
    assert label == {
        "kind": "positive",
        "tags": ["yes"],
        "lang": "en",
        "route": "car",
        "route_key": None,
        "intervals": [],
    }
    (entry,) = _lines(corpus / "manifest.jsonl")
    assert entry["clip"] == clip and entry["duration_ms"] == 1000 and entry["rate"] == 16000
    assert entry["source"] == {
        "root": str(dev),
        "mode": "call",
        "call_id": CALL,
        "leg": 0,
        "file": f"{CALL}-0.wav",
    }
    import hashlib

    assert entry["sha256"] == hashlib.sha256(raw.read_bytes()).hexdigest()
    if os.name != "nt":
        for d in (corpus, corpus / "raw", corpus / "labels"):
            assert d.stat().st_mode & 0o777 == 0o700
        for f in (raw, corpus / "labels" / f"{raw.stem}.json", corpus / "manifest.jsonl"):
            assert f.stat().st_mode & 0o777 == 0o600
    # label: kind + a tag, merged
    assert (
        corpus_tool.main(["--home", str(home), "label", raw.stem, "--kind", "negative", "--label", "car"])
        == 0
    )
    assert json.loads((corpus / "labels" / f"{raw.stem}.json").read_text())["tags"] == ["car", "yes"]
    capsys.readouterr()
    assert corpus_tool.main(["--home", str(home), "list"]) == 0
    listing = capsys.readouterr().out
    assert clip in listing and "negative" in listing and "1 clip(s)" in listing
    # prune: nothing is older than a day; everything is older than −1 days
    assert corpus_tool.main(["--home", str(home), "prune", "--older-than", "1"]) == 0
    assert raw.exists()
    assert corpus_tool.main(["--home", str(home), "prune", "--older-than", "-1"]) == 0
    assert not raw.exists() and not (corpus / "labels" / f"{raw.stem}.json").exists()
    assert (corpus / "manifest.jsonl").read_text() == ""


def test_corpus_imports_a_crashed_part(corpus_tool: ModuleType, tmp_path: Path, capsys: Any) -> None:
    """§6.1: a crash leaves a `.part` the corpus tool can still import — repaired into a proper WAV."""
    pcm = _seed_capture(tmp_path, part=True, leg=2)
    assert corpus_tool.main(["--home", str(tmp_path), "promote", f"{CALL}-2", "--owner-only"]) == 0
    (raw,) = (tmp_path / "asr-corpus" / "raw").iterdir()
    with wave.open(str(raw), "rb") as w:
        assert w.getnframes() == 16000 and w.readframes(16000) == pcm


def test_corpus_refusals(
    corpus_tool: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    _seed_capture(tmp_path)
    promote = ["promote", f"{CALL}-0", "--owner-only"]
    # no home: neither --home nor CTRLB_HOME (never the project-root fallback, H10)
    monkeypatch.delenv("CTRLB_HOME", raising=False)
    assert corpus_tool.main(promote) == 2
    # no --owner-only: the rule is printed, nothing is written (H11)
    assert corpus_tool.main(["--home", str(tmp_path), "promote", f"{CALL}-0"]) == 2
    assert "OWNER'S OWN VOICE ONLY" in capsys.readouterr().out
    assert not (tmp_path / "asr-corpus").exists()
    # a malformed id; a capture that is not there
    assert corpus_tool.main(["--home", str(tmp_path), "promote", "../x-0", "--owner-only"]) == 2
    assert corpus_tool.main(["--home", str(tmp_path), "promote", f"{CALL}-7", "--owner-only"]) == 1
    # CTRLB_HOME is enough; a second promotion of the same capture never clobbers the first
    monkeypatch.setenv("CTRLB_HOME", str(tmp_path))
    assert corpus_tool.main(promote) == 0
    (raw,) = (tmp_path / "asr-corpus" / "raw").iterdir()
    before = raw.read_bytes()
    assert corpus_tool.main(promote) == 1
    assert raw.read_bytes() == before
    assert "never overwritten" in capsys.readouterr().err
    # a destination inside a git work tree (H10)
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    _seed_capture(repo)
    assert corpus_tool.main(["--home", str(repo), *promote]) == 1
    assert not (repo / "asr-corpus").exists()


@pytest.mark.parametrize(
    "cmd", [["list"], ["prune", "--older-than", "-1"], ["label", "x", "--kind", "negative"]]
)
def test_every_corpus_operation_refuses_a_git_work_tree(
    corpus_tool: ModuleType, tmp_path: Path, cmd: list[str], capsys: Any
) -> None:
    """H10 for EVERY operation (S6-ii wave 1, Emma MED): `prune` / `label` would mutate a corpus inside a
    work tree, `list` would read one — all refuse before touching it."""
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    raw = repo / "asr-corpus" / "raw"
    raw.mkdir(parents=True)
    (raw / "x.wav").write_bytes(pcm16_wav_header(0, 16000))
    (repo / "asr-corpus" / "manifest.jsonl").write_text(
        json.dumps({"clip": "x.wav", "promoted_at": "2020-01-01T00:00:00+00:00"}) + "\n"
    )
    assert corpus_tool.main(["--home", str(repo), *cmd]) == 1
    assert "inside a git work tree" in capsys.readouterr().err
    assert (raw / "x.wav").exists()


@pytest.mark.parametrize(
    ("what", "content", "cmd"),
    [
        ("manifest", "{not json\n", ["prune", "--older-than", "0"]),
        ("manifest", '{"clip": "x.wav"}\n', ["prune", "--older-than", "0"]),  # no promoted_at
        (
            "manifest",
            '{"clip": "x.wav", "promoted_at": "2020-01-01T00:00:00"}\n',
            ["prune", "--older-than", "0"],
        ),
        ("label", "[1, 2]", ["list"]),
        ("label", "{oops", ["label", "x", "--kind", "negative"]),
    ],
)
def test_a_corrupt_manifest_or_label_is_a_one_line_error(
    corpus_tool: ModuleType, tmp_path: Path, what: str, content: str, cmd: list[str], capsys: Any
) -> None:
    corpus = tmp_path / "asr-corpus"
    (corpus / "raw").mkdir(parents=True)
    (corpus / "labels").mkdir()
    (corpus / "raw" / "x.wav").write_bytes(pcm16_wav_header(0, 16000))
    target = corpus / "manifest.jsonl" if what == "manifest" else corpus / "labels" / "x.json"
    target.write_text(content)
    assert corpus_tool.main(["--home", str(tmp_path), *cmd]) == 1
    err = capsys.readouterr().err
    assert err.count("\n") == 1 and str(target) in err and "corrupt" in err
    assert (corpus / "raw" / "x.wav").exists()  # nothing was deleted on the way to the error


def test_corpus_needs_a_language_when_the_trail_names_none(
    corpus_tool: ModuleType, tmp_path: Path, capsys: Any
) -> None:
    _seed_capture(tmp_path, lang=None)
    base = ["--home", str(tmp_path), "promote", f"{CALL}-0", "--owner-only"]
    assert corpus_tool.main(base) == 2
    assert corpus_tool.main([*base, "--lang", "es"]) == 0
    (raw,) = (tmp_path / "asr-corpus" / "raw").iterdir()
    assert "-call-car-es-" in raw.name
